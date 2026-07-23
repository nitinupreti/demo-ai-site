/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

/**
 * Sling Model backing the {@code service-card} component.
 *
 * Dialog contract (6 fields, per Figma-derived spec):
 *  - title              (Textfield, required)
 *  - description        (Textfield, required)
 *  - imagePath          (Pathfield, required) - DAM asset path
 *  - ctas               (Multifield, required) - CTA buttons: {ctaTitle, ctaLink}
 *  - backgroundColor    (Select: mint | white | other, default mint)
 *  - backgroundColorHex (Textfield, visible when backgroundColor = other)
 *  - margin             (Select: left | right, default right, required)
 *
 * The single {@code margin} field encodes both the empty-space side and the
 * image side. margin=right means the card hugs the LEFT edge (empty space
 * on the right) with the image on the LEFT of the card; margin=left is the
 * mirror.
 */
@Model(adaptables = Resource.class,
       defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class ServiceCardModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String description;

    @ValueMapValue
    private String imagePath;

    @ValueMapValue
    @Default(values = "mint")
    private String backgroundColor;

    @ValueMapValue
    private String backgroundColorHex;

    @ValueMapValue
    @Default(values = "right")
    private String margin;

    @ChildResource(name = "ctas")
    private List<Resource> ctaResources;

    private List<CtaItem> ctas = Collections.emptyList();

    @PostConstruct
    protected void init() {
        if (ctaResources == null || ctaResources.isEmpty()) {
            ctas = Collections.emptyList();
            return;
        }
        List<CtaItem> out = new ArrayList<>(ctaResources.size());
        for (Resource child : ctaResources) {
            CtaItem item = child.adaptTo(CtaItem.class);
            if (item != null && item.hasContent()) {
                out.add(item);
            }
        }
        ctas = Collections.unmodifiableList(out);
    }

    public String getTitle() {
        return title;
    }

    public String getDescription() {
        return description;
    }

    public String getImagePath() {
        return imagePath;
    }

    public String getBackgroundColor() {
        return backgroundColor;
    }

    public String getBackgroundColorHex() {
        return backgroundColorHex;
    }

    /**
     * Inline {@code style} attribute value for the card background when the
     * author has selected "Other" and provided a hex value. Returns
     * {@code null} otherwise, so HTL can safely omit the attribute.
     */
    public String getBackgroundStyle() {
        if ("other".equals(backgroundColor)
                && backgroundColorHex != null
                && !backgroundColorHex.trim().isEmpty()) {
            return "background-color: " + backgroundColorHex.trim() + ";";
        }
        return null;
    }

    public String getMargin() {
        return margin;
    }

    public List<CtaItem> getCtas() {
        return ctas;
    }

    public boolean isHasCtas() {
        return !ctas.isEmpty();
    }

    public boolean isHasContent() {
        return notBlank(title)
            || notBlank(description)
            || notBlank(imagePath)
            || isHasCtas();
    }

    private static boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }
}
