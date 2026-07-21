/*
 *  Copyright 2026 Adobe Systems Incorporated
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
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
 * Sling Model for the Tile component. Exposes dialog-authored properties, including the CTA
 * multifield and the optional custom background hex code, to the HTL template.
 */
@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class TileModel {

    private static final String BG_OTHER = "other";

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String description;

    @ValueMapValue
    @Default(values = "mint-green")
    private String backgroundColor;

    @ValueMapValue
    private String backgroundColorHex;

    @ValueMapValue
    @Default(values = "right")
    private String margin;

    @ValueMapValue
    private String image;

    @ChildResource(name = "ctaButtons")
    private List<Resource> ctaButtonResources;

    private List<CtaButton> ctaButtons;

    @PostConstruct
    protected void init() {
        List<CtaButton> buttons = new ArrayList<>();
        if (ctaButtonResources != null) {
            for (Resource itemResource : ctaButtonResources) {
                CtaButton cta = itemResource.adaptTo(CtaButton.class);
                if (cta != null && cta.hasContent()) {
                    buttons.add(cta);
                }
            }
        }
        this.ctaButtons = Collections.unmodifiableList(buttons);
    }

    public String getTitle() {
        return title;
    }

    public String getDescription() {
        return description;
    }

    public String getBackgroundColor() {
        return backgroundColor;
    }

    public String getBackgroundColorHex() {
        return backgroundColorHex;
    }

    public String getMargin() {
        return margin;
    }

    public String getImage() {
        return image;
    }

    public List<CtaButton> getCtaButtons() {
        return ctaButtons;
    }

    /**
     * Returns an inline style declaration when the author selected a custom background hex code.
     * The value is written into the {@code style} attribute of the tile section using the
     * {@code styleString} HTL context so unsafe input is stripped by the HTL runtime.
     *
     * @return CSS declaration such as {@code background-color:#d2f8dc} or {@code null}
     */
    public String getInlineStyle() {
        if (BG_OTHER.equals(backgroundColor) && isValidHex(backgroundColorHex)) {
            return "background-color:" + backgroundColorHex;
        }
        return null;
    }

    /**
     * @return {@code true} when the component has enough authored data to render.
     */
    public boolean isHasContent() {
        return title != null && !title.isEmpty();
    }

    private static boolean isValidHex(String value) {
        return value != null && value.matches("^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$");
    }

}
