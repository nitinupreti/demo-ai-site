/*
 * Copyright 2026 Demo AI Site
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CtaPanelModel {

    @ValueMapValue private String eyebrow;
    @ValueMapValue private String heading;
    @ValueMapValue private String description;
    @ValueMapValue private String image;
    @ValueMapValue private String imageAlt;
    @ValueMapValue private String ctaLabel;
    @ValueMapValue private String ctaLink;
    @ValueMapValue private String secondaryCtaLabel;
    @ValueMapValue private String secondaryCtaLink;

    @ValueMapValue @Default(values = "default") private String style;
    @ValueMapValue @Default(values = "left") private String mediaSide;

    public String getEyebrow() { return eyebrow; }
    public String getHeading() { return heading; }
    public String getDescription() { return description; }
    public String getImage() { return image; }
    public String getImageAlt() { return imageAlt; }
    public String getCtaLabel() { return ctaLabel; }
    public String getCtaLink() { return ctaLink; }
    public String getSecondaryCtaLabel() { return secondaryCtaLabel; }
    public String getSecondaryCtaLink() { return secondaryCtaLink; }
    public String getStyle() { return style; }
    public String getMediaSide() { return mediaSide; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading)
            || StringUtils.isNotBlank(description)
            || StringUtils.isNotBlank(image);
    }
}
