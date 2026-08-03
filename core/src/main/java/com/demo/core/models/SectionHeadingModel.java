/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;
import org.apache.sling.models.annotations.Default;

/**
 * Sling Model for the Positivus Section Heading component.
 *
 * <p>The design shows a green pill-shaped label with an inline subtitle. Every
 * subsequent section on the page reuses this pattern. Fields directly mirror
 * the dialog: label text, optional subtitle, alignment, and label background
 * color.</p>
 */
@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class SectionHeadingModel {

    @ValueMapValue
    private String label;

    @ValueMapValue
    private String subtitle;

    @ValueMapValue
    @Default(values = "left")
    private String align;

    @ValueMapValue
    @Default(values = "green")
    private String labelColor;

    private boolean hasContent;

    @PostConstruct
    protected void init() {
        hasContent = StringUtils.isNotBlank(label);
    }

    public String getLabel() {
        return label;
    }

    public String getSubtitle() {
        return subtitle;
    }

    public String getAlign() {
        return align;
    }

    public String getLabelColor() {
        return labelColor;
    }

    public boolean isHasContent() {
        return hasContent;
    }
}
